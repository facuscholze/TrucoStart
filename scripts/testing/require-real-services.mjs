const realServicesRequired = process.env['TRUCO_REQUIRE_REAL_SERVICES'] === '1';

if (realServicesRequired) {
  const missingServices = [
    ['DATABASE_URL', process.env['DATABASE_URL']],
    ['REDIS_URL', process.env['REDIS_URL']],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missingServices.length > 0) {
    throw new Error(
      `TRUCO_REQUIRE_REAL_SERVICES=1 requires real integration services; missing: ${missingServices.join(', ')}.`,
    );
  }
}
