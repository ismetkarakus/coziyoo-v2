export type ApiErrorShape = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  retriable: boolean;
  rawBody?: unknown;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  retriable: boolean;
  rawBody?: unknown;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.status = shape.status;
    this.code = shape.code;
    this.details = shape.details;
    this.retriable = shape.retriable;
    this.rawBody = shape.rawBody;
  }
}
