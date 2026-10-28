# session-mesh lease: $1 root, $2 name, $3 pid, $4 lstart, $5 owner json, $6 acquire|check|release|steal|list|release-all
L="$1/leases/$2"; P=$3; S=$4; O=$5
mkdir -p "$1/leases"
top() { ls -d "$L".g* 2>/dev/null | sed 's/.*\.g//' | sort -n | tail -1; }
judge() {
  d="$L.g$1"; H=
  if [ -e "$d/released" ]; then st=free; return; fi
  if [ ! -f "$d/owner" ]; then
    if [ $(( $(date +%s) - $(stat -c %Y "$d" 2>/dev/null || stat -f %m "$d") )) -lt 30 ]; then st=held; H=acquiring; else st=free; fi; return
  fi
  H=$(cat "$d/owner")
  op=$(printf %s "$H" | sed -n 's/.*"pid":"\([0-9]*\)".*/\1/p')
  ol=$(printf %s "$H" | sed -n 's/.*"lstart":"\([^"]*\)".*/\1/p')
  if [ "$op" = "$P" ] && [ "$ol" = "$S" ]; then st=mine; return; fi
  live=$(ps -o lstart= -p "$op" 2>/dev/null | tr -s ' ' | sed 's/^ //;s/ $//')
  if [ -n "$live" ] && [ "$live" = "$ol" ]; then st=held; else st=free; fi
}
acquire() {
  cur=$(top)
  if [ -n "$cur" ]; then
    judge "$cur"
    case $st in mine) echo mine; return;; held) echo "held $H"; return;; esac
  fi
  n=$(( ${cur:-0} + 1 ))
  if mkdir "$L.g$n" 2>/dev/null; then
    printf '%s' "$O" > "$L.g$n/.o.$$" && mv "$L.g$n/.o.$$" "$L.g$n/owner"; echo won
  else
    judge "$n"; [ "$st" = held ] && [ "$H" = acquiring ] && { sleep 0.3; judge "$n"; }
    [ "$st" = mine ] && echo mine || echo "held ${H:-acquiring}"
  fi
}
case $6 in
  acquire) acquire;;
  check) cur=$(top); if [ -z "$cur" ]; then echo free; else judge "$cur"; echo "$st $H"; fi;;
  release) cur=$(top); [ -n "$cur" ] && { judge "$cur"; [ "$st" = mine ] && : > "$L.g$cur/released"; }; echo ok;;
  steal) cur=$(top); [ -n "$cur" ] && : > "$L.g$cur/released"; acquire;;
  list) for b in $(ls -d "$1"/leases/*.g* 2>/dev/null | sed 's/\.g[0-9]*$//' | sort -u); do
          L=$b; judge "$(top)"; [ "$st" != free ] && echo "$st $H"; done; true;;
  release-all) for o in "$1"/leases/*.g*/owner; do
          [ -f "$o" ] && grep -q "\"pid\":\"$P\"" "$o" && grep -q "\"lstart\":\"$S\"" "$o" && : > "${o%/owner}/released"; done; true;;
esac
