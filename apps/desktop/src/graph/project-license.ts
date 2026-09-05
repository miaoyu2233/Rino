export const DEFAULT_PROJECT_LICENSE = "LicenseRef-Proprietary";

const LICENSE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/u;

export function normalizeProjectLicense(value: string): string | undefined {
  const normalized = value.trim();
  return LICENSE_IDENTIFIER_PATTERN.test(normalized) ? normalized : undefined;
}
