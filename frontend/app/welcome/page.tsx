import { redirect } from "next/navigation";

// The story page now lives at the root.
export default function Welcome() {
  redirect("/");
}
