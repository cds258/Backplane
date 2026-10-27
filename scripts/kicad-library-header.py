#!/usr/bin/env python3
"""Verify the immutable library payload and embed it in the shared service build.

All service targets use build-js.sh, including native desktop components. No
installer/SDK gate is bypassed and no network access is needed at runtime.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PIN = ROOT / 'deploy/kicad-library.lock.json'
MAX_FILES = 512
MAX_BYTES = 64 * 1024 * 1024


def safe(name):
    return (isinstance(name, str) and bool(name) and '\\' not in name and ':' not in name
            and not any(p in ('', '.', '..') for p in name.split('/'))
            and not any(ord(c) < 32 for c in name))


def verify(data, pin):
    if len(data) != pin['bytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
        raise ValueError('KiCad library archive checksum/size mismatch')
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for item in archive:
            if (not safe(item.name) or not item.name.startswith(pin['root'] + '/')
                    or not item.isfile() or item.name in files or item.size > MAX_BYTES):
                raise ValueError('Unsafe KiCad library archive member')
            total += item.size
            if len(files) >= MAX_FILES or total > MAX_BYTES:
                raise ValueError('KiCad library archive exceeds bounds')
            files[item.name] = archive.extractfile(item).read()
    prefix = pin['root'] + '/'
    files = {k[len(prefix):]: v for k, v in files.items()}
    manifest = json.loads(files['BUNDLE_MANIFEST.json'])
    for key in ('repository', 'version', 'source_commit', 'root', 'footprint_count', 'step_model_count', 'library_nicknames'):
        if manifest.get(key) != pin[key]:
            raise ValueError('KiCad library manifest mismatch: ' + key)
    if (manifest.get('schema_version') != 1 or manifest.get('required_path_variable') != 'BACKPLANE_KICAD_LIBRARY'
            or manifest.get('footprint_path') != 'libraries' or manifest.get('model_path') != '3dmodels'
            or not isinstance(manifest.get('files'), dict)):
        raise ValueError('Invalid KiCad library manifest')
    expected = manifest['files']
    if set(files) != set(expected) | {'BUNDLE_MANIFEST.json', 'SHA256SUMS'}:
        raise ValueError('KiCad library manifest inventory mismatch')
    for name, digest in expected.items():
        if not safe(name) or hashlib.sha256(files[name]).hexdigest() != digest:
            raise ValueError('KiCad library file checksum mismatch: ' + name)
    footprints = [n for n in files if n.endswith('.kicad_mod')]
    if len(footprints) != pin['footprint_count'] or len([n for n in files if n.endswith('.step')]) != pin['step_model_count']:
        raise ValueError('KiCad library geometry inventory mismatch')
    if {n.split('/')[1][:-7] for n in footprints if n.startswith('libraries/')} != set(pin['library_nicknames']):
        raise ValueError('KiCad library nicknames mismatch')
    return manifest


def payload(pin, archive=None):
    if archive:
        data = Path(archive).read_bytes()
        verify(data, pin)
        return data
    cache = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'backplane-bend/kicad-library'
    cache.mkdir(parents=True, exist_ok=True)
    saved = cache / (pin['sha256'] + '.tar.gz')
    if saved.exists():
        data = saved.read_bytes()
        verify(data, pin)  # Fail closed; a corrupt cache never falls back silently.
        return data
    with urllib.request.urlopen(pin['url'], timeout=60) as response:
        data = response.read(pin['bytes'] + 1)
    verify(data, pin)
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as f:
        temp = Path(f.name)
        f.write(data)
    try:
        temp.replace(saved)
    finally:
        temp.unlink(missing_ok=True)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--archive', type=Path, help='Offline archive; still checked against the immutable pin')
    args = parser.parse_args()
    pin = json.loads(PIN.read_text())
    data = payload(pin, args.archive)
    # The compiled digest inventory lets a later process validate an existing
    # extraction without decoding the archive again (ordinary plot children
    # do not even call setup). The original archive remains embedded for repair.
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        hashes = {m.name[len(pin['root'])+1:]: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive}
    args.output.write_text('globalThis.BACKPLANE_KICAD_BUNDLE = ' + json.dumps(
        {'pin': pin, 'files': hashes, 'base64': base64.b64encode(data).decode('ascii')}, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
