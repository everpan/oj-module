import { createElement } from "react";

import { CodeLogin } from "./components/code-login";
import { ForgotPassword } from "./components/forgot-password";
import { MustChangePassword } from "./components/must-change-password";
import { PasswordLogin } from "./components/password-login";
import { RegisterPassword } from "./components/register-password";

export const FORM_COMPONENT_MAP = {
	login: createElement(PasswordLogin),
	register: createElement(RegisterPassword),
	forgotPassword: createElement(ForgotPassword),
	codeLogin: createElement(CodeLogin),
	mustChange: createElement(MustChangePassword),
};
