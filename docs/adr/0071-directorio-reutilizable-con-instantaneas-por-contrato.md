---
status: accepted
---

# Los datos de las partes se reutilizarán sin exponer un directorio como módulo

Cada Organización conservará datos reutilizables de Titulares contractuales y personas firmantes, privados y compartidos entre sus Emisores autorizados. Esos registros son infraestructura del flujo y no un módulo visible llamado `Contrapartes`. Durante la creación, el Emisor elegirá las partes mediante campos simples o abrirá una pantalla dedicada para dar de alta la que falta y regresar a la captura. El Contrato-plantilla pedirá únicamente los datos adicionales aplicables. Al ejecutar `Generar Contrato`, la plataforma copiará todos los datos efectivos a una Instantánea contractual de parte inmutable vinculada con el Contrato emitido.

La navegación ofrecerá `Recientes` para originar un Borrador a partir de un Contrato anterior. Reutilizará campos compatibles, la publicación vigente de la misma plantilla y los registros activos actuales de sus partes; nunca copiará estado, referencia, enlace, evidencia o aceptación. Cada persona podrá marcar Contratos como `Favoritos` para colocarlos primero en su propia lista.

Actualizar un dato reutilizable sólo afectará selecciones futuras. Nunca modificará el texto, las partes, la evidencia o la historia de un Contrato ya emitido.

## Considered Options

- Capturar nuevamente todos los datos de las partes para cada Contrato.
- Mantener un formulario universal que exija todos los datos imaginables de todas las industrias.
- Referenciar siempre el perfil vigente del directorio y reflejar sus cambios en contratos anteriores.
- Reutilizar un núcleo común pequeño, capturar sólo los datos adicionales exigidos por el Contrato-plantilla y congelar una instantánea independiente en cada emisión.

## Consequences

- Los datos reutilizables de partes estarán aislados por Organización y no expondrán registros entre clientes de la plataforma.
- Un registro creado por un Emisor estará disponible para los demás Emisores autorizados de la misma Organización; no existirán libretas personales paralelas.
- Cualquier Emisor autorizado podrá crear y corregir registros compartidos, y cada alta o modificación conservará actor, fecha y valores cambiados.
- Sólo un Administrador podrá desactivar un registro. La desactivación impedirá seleccionarlo en emisiones futuras sin alterar contratos o instantáneas anteriores.
- Un registro utilizado por al menos un Contrato nunca se eliminará físicamente.
- El Emisor seleccionará un Titular contractual y, cuando corresponda, una persona firmante ya registrados mediante controles directos, sin buscador o directorio intermedio.
- El Firmante siempre será persona física. Si el Titular también es persona física, la captura ofrecerá una casilla explícita para usar el mismo registro como Titular y Firmante; si el Titular es persona moral, la casilla permanecerá deshabilitada y se explicará que debe elegirse a la persona que aceptará en su nombre.
- El Emisor podrá crear un registro en una pantalla dedicada y volver al Borrador que estaba capturando.
- Los datos reutilizables no impondrán un expediente universal de persona o empresa; cada Contrato-plantilla determinará cuáles datos comunes y adicionales son necesarios para emitir.
- Cuando un dato reutilizable ya exista, el flujo lo precargará y sólo pedirá completar o corregir lo faltante.
- La detección y resolución de registros semejantes no interrumpirá la captura inicial y queda como evolución posterior de administración.
- Provisionalmente, el núcleo obligatorio del Titular contractual será tipo de persona y nombre completo o razón social; para el Firmante será nombre completo.
- RFC, domicilio, teléfono, correo, cargo, facultades y otros campos sólo serán obligatorios cuando el Contrato-plantilla los requiera.
- Responsable juridico deberá entregar el criterio jurídico definitivo sobre este núcleo y Publicador de plataforma será el único que apruebe cualquier cambio antes de operar contratos reales. Esta lista permite continuar el diseño, pero no constituye todavía contenido aprobado para publicación.
- El Resumen previo a la emisión mostrará los datos que serán congelados, no una referencia abstracta a los registros reutilizables.
- La emisión conservará identificadores de origen, valores exactos y fecha de la instantánea para trazabilidad, pero el Contrato no dependerá de que el registro original siga activo.
- Una corrección posterior de los datos reutilizables no corregirá retroactivamente contratos emitidos; cualquier cambio contractual seguirá el mecanismo de sustitución o nueva emisión aplicable.
- `Duplicar para corregir`, `Crear nuevo a partir de este` y la acción equivalente en `Recientes` originarán Borradores nuevos usando los registros activos actuales para Titular contractual y Firmante. Nunca copiarán esos datos desde la instantánea histórica del Contrato de origen.
- `Favorito` será una preferencia personal por Cuenta individual y no modificará el Contrato ni el orden para otros Miembros.
- Si un registro relacionado fue desactivado, el Emisor deberá seleccionar o crear otro registro activo antes de emitir el Borrador nuevo.
- La reutilización de datos no constituye verificación de identidad, vigencia de facultades o autenticidad de documentos.
- La lista definitiva del Núcleo de datos, el criterio técnico de semejanza, la resolución manual de duplicados confirmados, los avisos de privacidad y la conservación de los datos reutilizables se decidirán por separado.
