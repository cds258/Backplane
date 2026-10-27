import Base
import ../src/core/ref-origin.bend as O

def ref_origin_no_link(s: String) ->
  {O.Origin.text_links(False{}, s, "") == s : String}:
  {==}

def ref_origin_return_local() ->
  {O.Origin.id("peer~t", "peer") == "t" : String}:
  {==}

def ref_origin_owner_remote() ->
  {O.Origin.id("t", "peer") == "peer~t" : String}:
  {==}

def ref_origin_foreign_untouched() ->
  {O.Origin.id("other~t", "peer") == "other~t" : String}:
  {==}
