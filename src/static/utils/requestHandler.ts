import type { Request, Response } from "express";
import { AppError } from "./appError";

type Decoder<T> = { // Compatible with the generated decoders
    decode: (json: unknown) => T;
};

export const EmptyPayloadDecoder: Decoder<null> = {decode: () => null};

export const Optional = <T>(decoder: Decoder<T>): Decoder<T | undefined> => ({
    decode: (json: unknown) => {
        if (json === undefined || json === null) {
            return undefined;
        }
        return decoder.decode(json);
    }
});

export const StringDecoder: Decoder<string> = { decode: (v) => { const s = JSON.parse(v as string); if (typeof s !== 'string') throw new Error('Expected string'); return s; } };
export const IntegerDecoder: Decoder<number> = { decode: (v) => { const n = Number(JSON.parse(v as string)); if (!Number.isInteger(n)) throw new Error('Expected integer'); return n; } };
export const NumberDecoder: Decoder<number> = { decode: (v) => { const n = Number(JSON.parse(v as string)); if (!Number.isFinite(n)) throw new Error('Expected number'); return n; } };
export const BooleanDecoder: Decoder<boolean> = { decode: (v) => { const b = JSON.parse(v as string); if (typeof b !== 'boolean') throw new Error('Expected boolean'); return b; } };


export const handleAuthorizedRequest = <TAuth, TPayload, TParams extends Record<string, unknown>>(
    authDecoder: (req: Request) => Promise<TAuth>,
    payloadDecoder: Decoder<TPayload>,
    paramDecoders: { [K in keyof TParams]: { in: 'path' | 'query', decoder: Decoder<TParams[K]> } },
    handler: (auth: TAuth, payload: TPayload, params: TParams) => Promise<{status: number, body: unknown}>
) => {
    return async (req: Request, res: Response) => {
        let authInfo: TAuth;
        try {
            authInfo = await authDecoder(req);
        } catch (error) {
            if (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403)) {
                res.status(error.statusCode).json({error: {message: error.message}});
            } else {
                console.error('Auth error:', error);
                res.status(401).json({error: {message: 'Unauthorized'}});
            }
            return;
        }

        let payload: TPayload | undefined;
        try {
            payload = payloadDecoder.decode(req.body);
        } catch (error) {
            const message = (error instanceof Error ? error.message : 'Invalid request body')
                .split('. JSON: ')[0]
                .replace('must match format "date"', 'must be date (YYYY-MM-DD)');
            res.status(400).json({error: {message}});
            return;
        }

        let params: TParams = {} as TParams;
        for (const key in paramDecoders) {
            const param = paramDecoders[key];
            const value = param.in === 'path' ? req.params[key] : req.query[key];
            try {
                params[key] = param.decoder.decode(JSON.stringify(value));
            } catch (error) {
                const message = error instanceof Error ? error.message.split('. JSON: ')[0] : 'Invalid value';
                res.status(400).json({error: {message: `Invalid ${param.in} parameter '${key}': ${message}`}});
                return;
            }
        }

        try {
            const result = await handler(authInfo, payload, params);
            res.status(result.status).json(result.body);
        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({error: {message: error.message}});
            } else {
                console.error('Error processing request:', error);
                res.status(500).json({error: {message: 'Internal server error'}});
            }
        }
    };
}
