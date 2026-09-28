/** Multipart placement fields for a catalog upload. Null/undefined files under no category. */
export function catalogUploadFields(categoryId: string | null | undefined): Record<string, string> {
  return categoryId ? { categoryId } : {}
}
