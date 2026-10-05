import SwaggerParser from '@apidevtools/swagger-parser';

const document = await SwaggerParser.validate('openapi/openapi.yaml');
process.stdout.write(`Validated OpenAPI (${Object.keys(document.paths ?? {}).length} paths).\n`);
