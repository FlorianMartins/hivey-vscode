**free
ctl-opt dftactgrp(*no) actgrp(*new);

dcl-f CUSTMAST keyed usage(*input);
dcl-f QSYSPRT printer(132) usage(*output);

dcl-s nbLus packed(7:0);
dcl-s total packed(11:2);

dou %eof(CUSTMAST);
  read CUSTMAST;
  if not %eof(CUSTMAST);
    nbLus = nbLus + 1;
    total = total + CUSBAL;
  endif;
enddo;

except detail;

*inlr = *on;
