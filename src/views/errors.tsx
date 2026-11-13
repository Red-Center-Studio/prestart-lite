import type { FC } from "hono/jsx";
import type { AppUser } from "../env";
import { Page } from "./layout";
import { btn, H1 } from "./components";

interface Props {
  user?: AppUser | null;
  csrf: string;
}

export const NotFoundPage: FC<Props> = ({ user, csrf }) => (
  <Page title="Page not found" user={user} csrf={csrf}>
    <H1 sub="The page may have moved, or the link may be wrong.">Page not found</H1>
    <a href="/" class={btn("primary")}>
      Go to the start page
    </a>
  </Page>
);

export const ForbiddenPage: FC<Props> = ({ user, csrf }) => (
  <Page title="No access" user={user} csrf={csrf}>
    <H1 sub="Your role does not include this page. Ask an admin if you need access.">You do not have access</H1>
    <a href="/" class={btn("primary")}>
      Go to the start page
    </a>
  </Page>
);

/** Plain-function versions for use outside .tsx files. */
export const notFoundHtml = (props: Props) => <NotFoundPage {...props} />;
export const forbiddenHtml = (props: Props) => <ForbiddenPage {...props} />;
export const serverErrorHtml = (props: Props) => <ServerErrorPage {...props} />;

export const ServerErrorPage: FC<Props> = ({ user, csrf }) => (
  <Page title="Something went wrong" user={user} csrf={csrf}>
    <H1 sub="That did not work because of a problem on our side. Your last change may not have been saved.">
      Something went wrong
    </H1>
    <p class="mb-4 text-gray-700">Try again in a moment. If it keeps happening, tell your admin.</p>
    <a href="/" class={btn("primary")}>
      Go to the start page
    </a>
  </Page>
);
