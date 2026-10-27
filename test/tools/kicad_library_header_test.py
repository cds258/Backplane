#!/usr/bin/env python3
"""Build-time verifier negatives: no network, runtime or project writes."""
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import select
import shlex
import shutil
import subprocess
import tarfile
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('library_header', ROOT/'scripts/kicad-library-header.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

class Payload(unittest.TestCase):
    def fixture(self, mutate=None, members=None, files_mutate=None):
        pin = dict(repository='fixture', version='1.0', source_commit='a'*40, root='Backplane_KiCad_Library',
                   footprint_count=1, step_model_count=1, library_nicknames=['Example'])
        files = {'libraries/Example.pretty/A.kicad_mod':b'footprint', '3dmodels/A.step':b'model'}
        manifest = {**pin, 'schema_version':1, 'required_path_variable':'BACKPLANE_KICAD_LIBRARY',
                    'footprint_path':'libraries', 'model_path':'3dmodels',
                    'files':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()}}
        if mutate: mutate(manifest)
        files.update({'BUNDLE_MANIFEST.json':json.dumps(manifest).encode(), 'SHA256SUMS':b'sums'})
        if files_mutate: files_mutate(files)
        out=io.BytesIO()
        with tarfile.open(fileobj=out, mode='w:gz') as t:
            for n,b in files.items():
                m=tarfile.TarInfo(pin['root']+'/'+n);m.size=len(b);t.addfile(m,io.BytesIO(b))
            for m,b in members or []:t.addfile(m,io.BytesIO(b) if b else None)
        data=out.getvalue();pin.update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
        return data,pin
    def test_valid(self):
        d,p=self.fixture();self.assertEqual(h.verify(d,p)['footprint_count'],1)
    def test_digest(self):
        d,p=self.fixture();p['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'):h.verify(d,p)
    def test_manifest_identity(self):
        d,p=self.fixture(lambda m:m.update(source_commit='b'*40))
        with self.assertRaisesRegex(ValueError,'source_commit'):h.verify(d,p)
    def test_file_digest(self):
        d,p=self.fixture(files_mutate=lambda f:f.update({'3dmodels/A.step':b'damaged'}))
        with self.assertRaisesRegex(ValueError,'file checksum'):h.verify(d,p)
    def test_inventory(self):
        d,p=self.fixture(files_mutate=lambda f:f.update({'surprise':b'unlisted'}))
        with self.assertRaisesRegex(ValueError,'inventory'):h.verify(d,p)
    def test_member_paths(self):
        for n in ['../escape','/absolute','Other/file','Backplane_KiCad_Library/../escape','Backplane_KiCad_Library/a\\b','Backplane_KiCad_Library/C:drive','Backplane_KiCad_Library/a/./b']:
            with self.subTest(n=n):
                m=tarfile.TarInfo(n);d,p=self.fixture(members=[(m,None)])
                with self.assertRaisesRegex(ValueError,'Unsafe'):h.verify(d,p)
    def test_symlink_and_hardlink(self):
        for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE]:
            m=tarfile.TarInfo('Backplane_KiCad_Library/link');m.type=kind;m.linkname='/tmp/escape'
            d,p=self.fixture(members=[(m,None)])
            with self.assertRaisesRegex(ValueError,'Unsafe'):h.verify(d,p)
    def test_duplicate(self):
        m=tarfile.TarInfo('Backplane_KiCad_Library/3dmodels/A.step');d,p=self.fixture(members=[(m,None)])
        with self.assertRaisesRegex(ValueError,'Unsafe'):h.verify(d,p)
    def test_expanded_size_bound(self):
        old=h.MAX_BYTES
        try:
            h.MAX_BYTES=4;d,p=self.fixture()
            with self.assertRaises(ValueError):h.verify(d,p)
        finally:h.MAX_BYTES=old
    def test_file_count_bound(self):
        old=h.MAX_FILES
        try:
            h.MAX_FILES=1;d,p=self.fixture()
            with self.assertRaisesRegex(ValueError,'bounds'):h.verify(d,p)
        finally:h.MAX_FILES=old

class GuiLaunch(unittest.TestCase):
    def test_exact_gui_script_child_env_and_portable_detachment(self):
        source=(ROOT/'src/server/kicad.bend').read_text()
        script=json.loads(re.search(r'def KiCad.open.script\(\) -> String:\s*(".*")',source).group(1))
        for fallback,program in [(False,'kicad'),(True,'kicad'),(False,'pcbnew.exe')]:
            with self.subTest(perl_fallback=fallback,program=program),tempfile.TemporaryDirectory(prefix='bp-library-gui-') as td:
                d=Path(td);runtime=d/'runtime 日本';(runtime/'bin').mkdir(parents=True)
                fifo=d/'captured';os.mkfifo(fifo)
                probe=d/'probe.py';probe.write_text('import json,os,sys\nwith open(os.environ["BP_CAPTURE_FIFO"],"w") as f:f.write(json.dumps([sys.argv[1:],os.environ.get("BACKPLANE_KICAD_LIBRARY"),os.environ.get("KICAD_CONFIG_HOME")]))\n')
                binary=runtime/'bin'/program;binary.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(probe))+' "$@"\n');binary.chmod(0o700)
                env={**os.environ,'BP_CAPTURE_FIFO':str(fifo),'BACKPLANE_KICAD_LIBRARY':str(d/'library 日本'),'KICAD_CONFIG_HOME':str(d/'managed profile')}
                if fallback:
                    tools=d/'tools';tools.mkdir();(tools/'perl').symlink_to(shutil.which('perl'));env['PATH']=str(tools)
                document=str(d/('test.kicad_pcb' if program.startswith('pcbnew') else 'test.kicad_pro'))
                fd=os.open(fifo,os.O_RDONLY|os.O_NONBLOCK)
                try:
                    args=[str(runtime),document if program.startswith('kicad') else '',document if program.startswith('pcbnew') else '','']
                    r=subprocess.run(['/bin/sh','-c',script,'sh',*args],env=env,capture_output=True,text=True,timeout=5)
                    self.assertEqual(r.returncode,0,r.stdout+r.stderr)
                    self.assertTrue(select.select([fd],[],[],5)[0],'detached GUI stub did not report')
                    got=json.loads(os.read(fd,8192))
                    self.assertEqual(got,[[document],env['BACKPLANE_KICAD_LIBRARY'],env['KICAD_CONFIG_HOME']])
                finally:os.close(fd)

if __name__=='__main__':unittest.main()
