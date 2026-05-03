import { redirect } from "next/navigation";

/** Old path — avoid a second RSC bundle that breaks on some Windows + webpack chunk maps. */
export default function PreviewPathRedirect({ params }: { params: { id: string } }) {
  redirect(`/app/projects/${params.id}?preview=1`);
}
