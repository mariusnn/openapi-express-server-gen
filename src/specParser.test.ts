import { parseSpecFromString } from './specParser';

const BASE_SPEC = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
paths: {}
`;

describe('parseSpecFromString — validation', () => {
    test('throws on invalid YAML', () => {
        expect(() => parseSpecFromString('{ invalid yaml: [', 'spec.yaml'))
            .toThrow('Failed to parse spec');
    });

    test('throws on invalid JSON', () => {
        expect(() => parseSpecFromString('{invalid json', 'spec.json'))
            .toThrow('Failed to parse spec');
    });

    test('throws when openapi field is missing', () => {
        expect(() => parseSpecFromString('info:\n  title: Test\n', 'spec.yaml'))
            .toThrow('Unsupported OpenAPI version');
    });

    test('throws on OpenAPI 2.x (Swagger)', () => {
        expect(() => parseSpecFromString('openapi: "2.0"\ninfo:\n  title: Test\n', 'spec.yaml'))
            .toThrow('Unsupported OpenAPI version');
    });

    test('accepts OpenAPI 3.0', () => {
        expect(() => parseSpecFromString(BASE_SPEC.replace('3.1.0', '3.0.3'), 'spec.yaml'))
            .not.toThrow();
    });

    test('throws when operationId is not a valid TypeScript identifier', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
security:
  - BearerAuth: []
paths:
  /foo:
    get:
      operationId: create-foo
      responses:
        '200':
          description: ok
`;
        expect(() => parseSpecFromString(spec, 'spec.yaml'))
            .toThrow('not a valid TypeScript identifier');
    });
});

describe('parseSpecFromString — security schemes', () => {
    test('parses a bearer auth scheme', () => {
        const { securitySchemes } = parseSpecFromString(BASE_SPEC, 'spec.yaml');
        expect(securitySchemes).toEqual([{ name: 'BearerAuth' }]);
    });

    test('parses an apiKey scheme', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    ApiKey:
      type: apiKey
      in: header
      name: X-API-Key
paths: {}
`;
        const { securitySchemes } = parseSpecFromString(spec, 'spec.yaml');
        expect(securitySchemes).toEqual([{ name: 'ApiKey' }]);
    });

    test('includes all scheme types, including oauth2', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    OAuth:
      type: oauth2
      flows: {}
paths: {}
`;
        const { securitySchemes } = parseSpecFromString(spec, 'spec.yaml');
        expect(securitySchemes).toEqual([{ name: 'OAuth' }]);
    });

    test('parses multiple schemes', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
    ApiKey:
      type: apiKey
      in: header
      name: X-API-Key
paths: {}
`;
        const { securitySchemes } = parseSpecFromString(spec, 'spec.yaml');
        expect(securitySchemes.map(s => s.name)).toEqual(['BearerAuth', 'ApiKey']);
    });
});

describe('parseSpecFromString — operations', () => {
    test('parses a minimal operation', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
paths:
  /items:
    post:
      operationId: createItem
      security:
        - BearerAuth: []
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations).toHaveLength(1);
        expect(operations[0]).toMatchObject({
            operationId: 'createItem',
            httpMethod: 'post',
            expressPath: '/items',
            securitySchemeName: 'BearerAuth',
            parameters: [],
            requestBodySchemaRef: null,
            successStatus: 201,
            responseBodySchemaRef: 'Item',
        });
    });

    test('derives operationId from method and path when absent', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
paths:
  /file/upload/{fileId}:
    get:
      security:
        - BearerAuth: []
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].operationId).toBe('getFileUpload_fileId');
        warnSpy.mockRestore();
    });

    test('sets securitySchemeName to null when no security defined', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /public:
    get:
      operationId: getPublic
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].securitySchemeName).toBeNull();
        warnSpy.mockRestore();
    });

    test('inherits global security when operation has none', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
security:
  - BearerAuth: []
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].securitySchemeName).toBe('BearerAuth');
    });

    test('security: [] overrides global security — operation is public', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
security:
  - BearerAuth: []
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
paths:
  /public:
    get:
      operationId: getPublic
      security: []
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].securitySchemeName).toBeNull();
        warnSpy.mockRestore();
    });

    test('sets securityScopes to empty array when no scopes defined', () => {
        const { operations } = parseSpecFromString(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    BearerAuth: { type: http, scheme: bearer }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      responses:
        '200':
          description: OK
`, 'spec.yaml');
        expect(operations[0].securityScopes).toEqual([]);
    });

    test('extracts scopes from operation security requirement', () => {
        const { operations } = parseSpecFromString(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/token
          scopes:
            read:items: Read items
            write:items: Write items
paths:
  /items:
    get:
      operationId: listItems
      security:
        - OAuth2: [read:items, write:items]
      responses:
        '200':
          description: OK
`, 'spec.yaml');
        expect(operations[0].securityScopes).toEqual(['read:items', 'write:items']);
    });

    test('inherits scopes from global security', () => {
        const { operations } = parseSpecFromString(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
security:
  - OAuth2: [read:items]
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/token
          scopes:
            read:items: Read items
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: OK
`, 'spec.yaml');
        expect(operations[0].securityScopes).toEqual(['read:items']);
    });

    test('uses only HTTP methods, ignores path-item fields like summary', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    summary: Items resource
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations).toHaveLength(1);
        expect(operations[0].httpMethod).toBe('get');
    });
});

describe('parseSpecFromString — parameters', () => {
    test('parses a path parameter with string type', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items/{itemId}:
    get:
      operationId: getItem
      security:
        - BearerAuth: []
      parameters:
        - name: itemId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters).toEqual([
            { name: 'itemId', in: 'path', required: true, schemaRef: null, primitiveType: 'string' },
        ]);
    });

    test('parses a path parameter with integer type', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items/{itemId}:
    get:
      operationId: getItem
      security:
        - BearerAuth: []
      parameters:
        - name: itemId
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters[0]).toMatchObject({ primitiveType: 'integer' });
    });

    test('parses an optional query parameter', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      parameters:
        - name: filter
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters[0]).toMatchObject({ name: 'filter', required: false });
    });

    test('parses a query parameter with $ref schema', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      parameters:
        - name: mode
          in: query
          required: false
          schema:
            $ref: '#/components/schemas/CreationMode'
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters[0]).toMatchObject({
            name: 'mode',
            schemaRef: 'CreationMode',
            primitiveType: null,
        });
    });

    test('path-level parameters are merged with operation parameters', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items/{itemId}:
    parameters:
      - name: itemId
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getItem
      security:
        - BearerAuth: []
      parameters:
        - name: verbose
          in: query
          required: false
          schema:
            type: boolean
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        const paramNames = operations[0].parameters.map(p => p.name);
        expect(paramNames).toContain('itemId');
        expect(paramNames).toContain('verbose');
    });

    test('operation parameter overrides path-level parameter with same name', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items/{itemId}:
    parameters:
      - name: itemId
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getItem
      security:
        - BearerAuth: []
      parameters:
        - name: itemId
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        const itemIdParam = operations[0].parameters.find(p => p.name === 'itemId');
        expect(itemIdParam?.primitiveType).toBe('integer');
    });

    test('skips and warns on object/array schema params', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      parameters:
        - name: filter
          in: query
          schema:
            type: object
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"filter"'));
        warnSpy.mockRestore();
    });

    test('ignores header and cookie parameters', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      parameters:
        - name: X-Trace-Id
          in: header
          schema:
            type: string
        - name: session
          in: cookie
          schema:
            type: string
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].parameters).toHaveLength(0);
    });
});

describe('parseSpecFromString — request body', () => {
    test('extracts the $ref schema name from a JSON request body', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    post:
      operationId: createItem
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateItemInput'
      responses:
        '201':
          description: Created
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].requestBodySchemaRef).toBe('CreateItemInput');
    });

    test('sets requestBodySchemaRef to null when no body', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      responses:
        '200':
          description: OK
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].requestBodySchemaRef).toBeNull();
    });
});

describe('parseSpecFromString — responses', () => {
    test('extracts successStatus and responseBodySchemaRef from a 2xx response', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    post:
      operationId: createItem
      security:
        - BearerAuth: []
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].successStatus).toBe(201);
        expect(operations[0].responseBodySchemaRef).toBe('Item');
    });

    test('sets responseBodySchemaRef to null for a 204 no-content response', () => {
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items/{id}:
    delete:
      operationId: deleteItem
      security:
        - BearerAuth: []
      responses:
        '204':
          description: No Content
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].successStatus).toBe(204);
        expect(operations[0].responseBodySchemaRef).toBeNull();
    });

    test('uses lowest status code when multiple 2xx responses are defined', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    post:
      operationId: createItem
      security:
        - BearerAuth: []
      responses:
        '200':
          description: OK
        '201':
          description: Created
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].successStatus).toBe(200);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('multiple 2xx'));
        warnSpy.mockRestore();
    });

    test('sets successStatus to null when no 2xx response is defined', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = `
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      security:
        - BearerAuth: []
      responses:
        '400':
          description: Bad Request
`;
        const { operations } = parseSpecFromString(spec, 'spec.yaml');
        expect(operations[0].successStatus).toBeNull();
        expect(operations[0].responseBodySchemaRef).toBeNull();
        warnSpy.mockRestore();
    });
});

describe('parseSpecFromString — JSON format', () => {
    test('parses a JSON spec correctly', () => {
        const spec = JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Test', version: '1.0.0' },
            components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } } },
            paths: {
                '/items': {
                    get: {
                        operationId: 'listItems',
                        security: [{ BearerAuth: [] }],
                        responses: { '200': { description: 'OK' } },
                    },
                },
            },
        });
        const { operations, securitySchemes } = parseSpecFromString(spec, 'spec.json');
        expect(securitySchemes).toHaveLength(1);
        expect(operations[0].operationId).toBe('listItems');
    });
});
