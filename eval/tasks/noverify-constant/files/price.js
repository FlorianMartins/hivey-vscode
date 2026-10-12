const VAT = 0.2;

export function withVat(net) {
  return net * (1 + VAT);
}
