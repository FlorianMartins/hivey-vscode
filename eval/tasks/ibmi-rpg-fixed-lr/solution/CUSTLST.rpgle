     H DFTACTGRP(*NO) ACTGRP(*CALLER)
     FCUSTMAST  IF   E           K DISK
     D count           S              7  0
     D name            S             30A
      /free
       setll *start CUSTMAST;
       read CUSTMAST;
       dow not %eof(CUSTMAST);
         count = count + 1;
         name = CUSNAM;
         read CUSTMAST;
       enddo;
       dsply ('customers: ' + %char(count));
       // Without this the program stays active with CUSTMAST open, and the next call starts from
       // wherever the last one stopped reading.
       *inlr = *on;
      /end-free
