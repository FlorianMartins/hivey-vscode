from orders import line_total
from report import footer

assert line_total(3, 1.5) == "4.50 EUR", line_total(3, 1.5)
assert footer(12) == "TOTAL 12.00 USD", footer(12)
print("ok")
