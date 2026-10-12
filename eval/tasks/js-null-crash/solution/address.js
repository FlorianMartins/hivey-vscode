export function formatAddress(customer) {
  const address = customer?.address;
  if (!address) return "";
  const { street, city, postcode } = address;
  return `${street}, ${postcode} ${city}`;
}
