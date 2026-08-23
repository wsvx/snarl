/**
 * snarl, a minimal web framework for deno
 * Copyright (c) 2025-2026 kyu.re
 * SPDX-License-Identifier: MPL-2.0
 */

import { css } from "@404/aether";
import Todos from "../components/todo.tsx";

const Styled = css`
	body {
		background-color: #fafafa;
	}
`;

export default function Page() {
	return (
		<Styled.html>
			<body>
				<Todos />
			</body>
		</Styled.html>
	);
}
