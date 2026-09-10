     H DFTACTGRP(*NO) ACTGRP(*NEW)
     FCUSTMAST  IF   E           K DISK
     FQSYSPRT   O    F  132        PRINTER
     D nbLus           S              7  0
     D total           S             11  2
     C                   DOU       %eof(CUSTMAST)
     C                   READ      CUSTMAST
     C                   IF        NOT %eof(CUSTMAST)
     C                   EVAL      nbLus = nbLus + 1
     C                   EVAL      total = total + CUSBAL
     C                   ENDIF
     C                   ENDDO
     C                   EXCEPT    detail
     C                   EVAL      *INLR = *ON
