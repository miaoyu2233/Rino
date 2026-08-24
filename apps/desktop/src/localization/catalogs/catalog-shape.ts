export type CatalogShape<Catalog> = {
  readonly [Key in keyof Catalog]: Catalog[Key] extends string
    ? string
    : CatalogShape<Catalog[Key]>;
};
