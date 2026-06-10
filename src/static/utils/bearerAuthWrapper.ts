import { Request } from "express";
import { AppError } from "./appError";

export const bearerAuth = <TAuth>(handler: (token: string, scopes: string[]) => Promise<TAuth>) =>
    (req: Request, scopes: string[]): Promise<TAuth> => {
        if (!req.headers['authorization']) {
            throw AppError.Unauthorized('Authorization header is missing');
        }
        if (!req.headers['authorization'].startsWith('Bearer ')) {
            throw AppError.Unauthorized('Invalid authorization header format');
        }
        const token = req.headers['authorization'].slice(7); // Remove "Bearer " prefix
        return handler(token, scopes);
    };
