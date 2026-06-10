export function sanitizeInput(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function sanitizePassenger(p: any): any {
  return {
    ...p,
    name: p.name ? sanitizeInput(String(p.name)) : p.name,
  };
}
