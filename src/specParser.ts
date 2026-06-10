import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import type { ParsedSpec, SecurityScheme, Operation, Parameter } from './irTypes';


function isRef(obj: unknown): obj is OpenAPIV3.ReferenceObject {
    return typeof obj === 'object' && obj !== null && '$ref' in obj;
}

// ---- Pure helpers ----

function extractRefName(ref: string): string {
    return ref.split('/').pop() ?? ref;
}

function deriveOperationId(method: string, openApiPath: string): string {
    const segments = openApiPath.split('/').filter(Boolean);
    let result = method.toLowerCase();
    for (const seg of segments) {
        if (seg.startsWith('{')) {
            result += '_' + seg.slice(1, -1);
        } else {
            result += seg[0].toUpperCase() + seg.slice(1);
        }
    }
    return result;
}

function getParamInfo(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
): Pick<Parameter, 'schemaRef' | 'primitiveType'> {
    if (!schema) return { schemaRef: null, primitiveType: 'string' };
    if (isRef(schema)) return { schemaRef: extractRefName(schema.$ref), primitiveType: null };
    if (schema.type === 'integer') return { schemaRef: null, primitiveType: 'integer' };
    if (schema.type === 'number')  return { schemaRef: null, primitiveType: 'number' };
    if (schema.type === 'boolean') return { schemaRef: null, primitiveType: 'boolean' };
    return { schemaRef: null, primitiveType: 'string' };
}

// Extracts the $ref schema name from an OpenAPI content map, e.g.:
// { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } } → 'Foo'
function getJsonSchemaRef(
    content: { [media: string]: OpenAPIV3.MediaTypeObject } | undefined
): string | null {
    const schema = content?.['application/json']?.schema;
    if (!schema) return null;
    return isRef(schema) ? extractRefName(schema.$ref) : null;
}

// ---- Sub-parsers ----

function resolveSecurityScheme(
    op: OpenAPIV3.OperationObject,
    globalSecurity: OpenAPIV3.SecurityRequirementObject[] | undefined,
    operationId: string
): { schemeName: string; scopes: string[] } | null {
    const security = op.security ?? globalSecurity;
    if (!security || security.length === 0) {
        console.warn(`[warn] Operation "${operationId}" has no security requirement; this route will be skipped in index.ts (unsupported)`);
        return null;
    }
    const schemes = Object.keys(security[0]);
    if (schemes.length > 1) {
        console.warn(`[warn] Operation "${operationId}" has multiple security schemes; using first ("${schemes[0]}")`);
    }
    const schemeName = schemes[0];
    if (!schemeName) return null;
    return { schemeName, scopes: security[0][schemeName] ?? [] };
}

function parseParameters(
    pathLevelParams: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[],
    opParams: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[],
    components: OpenAPIV3.ComponentsObject | undefined,
    operationId: string
): Parameter[] {
    const paramMap = new Map<string, OpenAPIV3.ParameterObject>();

    for (const raw of [...pathLevelParams, ...opParams]) {
        let p: OpenAPIV3.ParameterObject;
        if (isRef(raw)) {
            const refName = raw.$ref.replace('#/components/parameters/', '');
            const resolved = components?.parameters?.[refName];
            if (!resolved || isRef(resolved)) {
                console.warn(`[warn] Could not resolve parameter $ref "${raw.$ref}"; skipping`);
                continue;
            }
            p = resolved;
        } else {
            p = raw;
        }

        if (p.in !== 'path' && p.in !== 'query') continue;

        const schema = p.schema;
        if (schema && !isRef(schema) && (schema.type === 'object' || schema.type === 'array')) {
            console.warn(`[warn] Operation "${operationId}" param "${p.name}" has object/array schema; skipping`);
            continue;
        }
        paramMap.set(`${p.in}:${p.name}`, p);
    }

    return [...paramMap.values()].map(p => ({
        name: p.name,
        in: p.in as 'path' | 'query',
        required: p.required ?? p.in === 'path',
        ...getParamInfo(p.schema),
    }));
}

function parseRequestBody(
    requestBody: OpenAPIV3.RequestBodyObject | OpenAPIV3.ReferenceObject | undefined
): string | null {
    if (!requestBody || isRef(requestBody)) return null;
    return getJsonSchemaRef(requestBody.content);
}

function parseSuccessResponse(
    responses: OpenAPIV3.ResponsesObject,
    operationId: string
): Pick<Operation, 'successStatus' | 'responseBodySchemaRef'> {
    const twoxxCodes = Object.keys(responses)
        .filter(k => /^2\d\d$/.test(k))
        .map(Number)
        .sort((a, b) => a - b);

    if (twoxxCodes.length === 0) {
        console.warn(`[warn] Operation "${operationId}" has no 2xx response defined`);
        return { successStatus: null, responseBodySchemaRef: null };
    }
    if (twoxxCodes.length > 1) {
        console.warn(`[warn] Operation "${operationId}" has multiple 2xx responses; using ${twoxxCodes[0]}`);
    }

    const successStatus = twoxxCodes[0];
    const response = responses[String(successStatus)];
    return {
        successStatus,
        responseBodySchemaRef: isRef(response) ? null : getJsonSchemaRef(response?.content),
    };
}

// ---- Entry points ----

export function parseSpecFromString(content: string, filename: string): ParsedSpec {
    let raw: unknown;
    try {
        raw = filename.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
    } catch (err) {
        throw new Error(`Failed to parse spec: ${err instanceof Error ? err.message : String(err)}`);
    }

    const version = (raw as Record<string, unknown>)?.openapi;
    if (typeof version !== 'string' || !version.startsWith('3.')) {
        throw new Error(`Unsupported OpenAPI version: "${version}". Only OpenAPI 3.x is supported.`);
    }

    const doc = raw as OpenAPIV3.Document;
    const securitySchemes = Object.keys(doc.components?.securitySchemes ?? {}).map(name => ({ name }));
    const operations: Operation[] = [];

    for (const [openApiPath, pathItem] of Object.entries(doc.paths ?? {})) {
        if (!pathItem) continue;
        const pathLevelParams = pathItem.parameters ?? [];

        for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
            const op: OpenAPIV3.OperationObject | undefined = pathItem[method];
            if (!op) continue;

            let operationId: string;
            if (op.operationId) {
                operationId = op.operationId;
            } else {
                operationId = deriveOperationId(method, openApiPath);
                console.warn(`[warn] Operation ${method.toUpperCase()} ${openApiPath} has no operationId; using "${operationId}"`);
            }

            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(operationId)) {
                throw new Error(`Operation "${operationId}" (${method.toUpperCase()} ${openApiPath}) is not a valid TypeScript identifier. Rename it in the spec.`);
            }

            const security = resolveSecurityScheme(op, doc.security, operationId);
            operations.push({
                operationId,
                httpMethod: method,
                expressPath: openApiPath.replace(/\{(\w+)\}/g, ':$1'),
                securitySchemeName: security?.schemeName ?? null,
                securityScopes: security?.scopes ?? [],
                parameters: parseParameters(pathLevelParams, op.parameters ?? [], doc.components, operationId),
                requestBodySchemaRef: parseRequestBody(op.requestBody),
                ...parseSuccessResponse(op.responses ?? {}, operationId),
            });
        }
    }

    return { securitySchemes, operations, specBaseName: filename };
}

export function parseSpec(filePath: string): ParsedSpec {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseSpecFromString(content, path.basename(filePath));
}
