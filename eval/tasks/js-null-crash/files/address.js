export function formatAddress(customer) {
  const { street, city, postcode } = customer.address;
  return `${street}, ${postcode} ${city}`;
}
