import { z } from "zod";

/**
 * A thing you sell, as the CRM knows it. ABMBuddy uses the selected product to
 * decide which well-supported hypothesis is most worth leading with, and to
 * keep collateral honest about what is actually on offer — never to invent a
 * problem that happens to match the pitch.
 */
export const productSchema = z.object({
  /** CRM record id. Absent when the product came from local config. */
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  /** Formatted for display only; ABMBuddy never does pricing maths. */
  price: z.string().optional(),
  sku: z.string().optional(),
  source: z.string().default("hubspot"),
});

export type Product = z.infer<typeof productSchema>;

/** How a product is described to an agent. Short, factual, no CRM noise. */
export function describeProduct(product: Product | undefined, fallback?: string): string | undefined {
  if (!product) return fallback;
  return [
    `Product: ${product.name}`,
    product.description ? `What it does: ${product.description}` : "",
    product.sku ? `SKU: ${product.sku}` : "",
    product.price ? `List price: ${product.price}` : "",
    fallback ? `Wider positioning: ${fallback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
