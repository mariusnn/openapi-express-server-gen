export interface SecurityScheme {
    name: string;
}

export interface Parameter {
    name: string;
    in: 'path' | 'query';
    required: boolean;
    schemaRef: string | null;        // schema name if $ref, e.g. "CreationMode"
    primitiveType: 'string' | 'integer' | 'number' | 'boolean' | null;
}

export interface Operation {
    operationId: string;
    httpMethod: string;              // "get", "post", etc.
    expressPath: string;             // "/fileUpload/:fileId"
    securitySchemeName: string | null;
    securityScopes: string[];        // required scopes for this operation
    parameters: Parameter[];         // merged path + query params
    requestBodySchemaRef: string | null;
    successStatus: number | null;    // null means no 2xx response found
    responseBodySchemaRef: string | null;
}

export interface ParsedSpec {
    securitySchemes: SecurityScheme[];
    operations: Operation[];
    specBaseName: string;
}
