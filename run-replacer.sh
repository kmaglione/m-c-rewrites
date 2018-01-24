#!/bin/sh

scriptdir=$(dirname $(which $0))


objdir=$(./mach environment | awk '$0 == "object directory:" { found = 1; next }; found { print $1; exit }')
dist_bin="$objdir/dist/bin"

export LD_LIBRARY_PATH="$dist_bin";
export XPCSHELL="$dist_bin/xpcshell"

"$XPCSHELL" "$scriptdir/main.js" "$scriptdir" "$@"
