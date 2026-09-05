/* Generated from contracts/registry/rino-registry-v1.schema.json. Do not edit directly. */

export interface ValidatorError {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

export interface StaticValidator {
  (data: unknown): boolean;
  errors?: ValidatorError[] | null;
}

export declare const rootValidator: StaticValidator;
export declare const definitionValidators: ReadonlyMap<string, StaticValidator>;
