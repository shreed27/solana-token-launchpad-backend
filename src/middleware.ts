import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; name: string };
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      id: string;
      email: string;
      name: string;
    };
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
