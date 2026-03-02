import { Navigate } from "react-router-dom";
import { isLoggedIn } from "../lib/auth";

export default function RouteGuard({ children }: { children: JSX.Element }) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
