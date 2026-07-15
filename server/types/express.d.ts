declare global {
  namespace Express {
    interface Request {
      requestId: string
      idempotency?: {
        key?: string
        scope?: string
        requestHash?: string
      }
    }
  }
}

export {}
