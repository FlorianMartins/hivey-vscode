**free
// Validate an order line.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s qty      packed(7:0);
dcl-s price    packed(11:2);
dcl-s custno   char(10);

// *IN03 comes from the display file: F3 is DDS's indicator, not ours, so it stays.
dcl-s exitKey  ind;

// One name per condition. The numbers said nothing and the key was in somebody's head.
dcl-s badQuantity ind;
dcl-s badPrice    ind;
dcl-s noCustomer  ind;

qty = 0;
price = -1;
custno = '          ';

badQuantity = *off;
badPrice    = *off;
noCustomer  = *off;

if qty <= 0;
  badQuantity = *on;
endif;
if price < 0;
  badPrice = *on;
endif;
if custno = *blanks;
  noCustomer = *on;
endif;

if badQuantity or badPrice or noCustomer;
  dsply ('order line refused');
else;
  dsply ('order line accepted');
endif;

if *in03;
  *inlr = *on;
  return;
endif;

*inlr = *on;
