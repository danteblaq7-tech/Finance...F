import { createContext } from 'react';

/** True inside the app shell (top bar + menu). Screens there sit on the white content panel and the shell already
 *  handles the top safe area; outside it (sign-in, register) they keep the grey page background. */
export const InShellContext = createContext(false);
