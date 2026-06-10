export class AppError extends Error {

    static InvalidInput = (message: string) => new AppError(400, message);
    static Unauthorized = (message: string) => new AppError(401, message);
    static Forbidden = (message: string) => new AppError(403, message);
    static NotFound = (message: string) => new AppError(404, message);

    static ServerError = (message: string) => new AppError(500, message);

    constructor(
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
    }
}
