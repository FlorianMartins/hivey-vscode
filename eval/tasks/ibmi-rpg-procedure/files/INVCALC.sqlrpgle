**free
// Invoice totals.
ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt: *nodebugio);

dcl-s netAmt    packed(11:2);
dcl-s vatAmt    packed(11:2);
dcl-s grossAmt  packed(11:2);
dcl-s lineNet   packed(11:2);
dcl-s lineVat   packed(11:2);
dcl-s hdrNet    packed(11:2);
dcl-s hdrVat    packed(11:2);

// ── One line ──────────────────────────────────────────────────────────────
lineNet = 100.00;
lineVat = lineNet * 0.21;
lineVat = %dec(lineVat + 0.005: 11: 2);
if lineVat < 0;
  lineVat = %dec(lineVat - 0.01: 11: 2);
endif;

// ── The header total ──────────────────────────────────────────────────────
hdrNet = 250.00;
hdrVat = hdrNet * 0.21;
hdrVat = %dec(hdrVat + 0.005: 11: 2);
if hdrVat < 0;
  hdrVat = %dec(hdrVat - 0.01: 11: 2);
endif;

// ── The credit note ───────────────────────────────────────────────────────
// This one drifted: it never got the correction for negative amounts.
netAmt = -40.00;
vatAmt = netAmt * 0.21;
vatAmt = %dec(vatAmt + 0.005: 11: 2);

grossAmt = netAmt + vatAmt;

*inlr = *on;
