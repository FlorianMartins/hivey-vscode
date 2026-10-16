#!/bin/sh
# Mutation testing, by hand: every mutant of duration.js breaks ONE documented rule, and the tests
# the agent wrote must notice each of them. A suite that passes on a broken implementation is not
# testing that rule.
cp duration.js .duration.original.js
survived=""
for mutant in mutants/*.js; do
  cp "$mutant" duration.js
  if timeout 60 node --test duration.test.js > /dev/null 2>&1; then
    survived="$survived $(basename "$mutant" .js)"
  fi
done
cp .duration.original.js duration.js
if [ -n "$survived" ]; then
  echo "duration.test.js still passes with these rules broken:$survived" >&2
  exit 1
fi
echo "every mutant was caught"
