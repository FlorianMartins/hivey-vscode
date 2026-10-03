const VAT = 0.21;

export function withVat(net) {
  return net * (1 + VAT);
}
