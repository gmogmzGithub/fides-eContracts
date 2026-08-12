---
status: accepted
---

# La administración de Fides y de AWS usará identidades separadas

Publicador de plataforma tendrá una identidad de Administrador de plataforma dentro de
Fides y otra identidad de Administrador de infraestructura AWS para
operar la nube. Aunque ambas pertenezcan a la misma persona, no compartirán
sesión, credenciales, tokens, permisos ni auditoría.

## Consequences

- Comprometer una sesión de Fides no concederá acceso a la cuenta AWS.
- La identidad AWS no podrá utilizarse directamente como sesión del producto ni aparecer como Miembro de una Organización.
- Los servicios usarán roles técnicos de mínimo privilegio distintos de ambas identidades humanas.
- Cada plano conservará su propia autenticación reforzada, recuperación y bitácora.
- La cuenta raíz AWS no se utilizará para operación cotidiana y sus credenciales se protegerán como recuperación excepcional.
- La tecnología concreta de identidad del producto y de acceso humano a AWS se decidirá durante el diseño ejecutable.
