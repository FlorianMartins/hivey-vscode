"""The shape the refactor asked for: no function in pricing.py longer than 25 lines."""

import ast
import sys

LIMIT = 25

with open("pricing.py", encoding="utf-8") as f:
    tree = ast.parse(f.read())

functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
too_long = [(f.name, f.end_lineno - f.lineno + 1) for f in functions if f.end_lineno - f.lineno + 1 > LIMIT]
names = {f.name for f in functions}

problems = []
if "quote" not in names:
    problems.append("quote() is gone")
if len(functions) < 3:
    problems.append(f"only {len(functions)} function(s): nothing was split")
for name, length in too_long:
    problems.append(f"{name}() is {length} lines long (at most {LIMIT})")

if problems:
    print("\n".join(problems), file=sys.stderr)
    sys.exit(1)
print(f"ok: {len(functions)} functions, the longest {max(f.end_lineno - f.lineno + 1 for f in functions)} lines")
