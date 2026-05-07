---
inclusion: auto
---

# Regla: controltimer

## Antes de iniciar cada tarea:
1. Indicar el tiempo promedio estimado de duración de la tarea
2. Pedir confirmación al usuario para continuar o detenerse

## Alerta de tiempo a los 31 minutos:
- A los 31 minutos desde que se inició el proceso, emitir una alerta al usuario con el siguiente contenido:
  1. **Estado del proceso**: indicar si el proceso va bien (sin errores) o si hay errores
  2. **Si hay errores**: listar cada error encontrado con una breve descripción
  3. **Decisión**: preguntar al usuario si desea:
     - Reparar los errores detectados y continuar
     - Detener el proceso por completo

## Durante la ejecución de cada tarea:
- Si la tarea supera el tiempo estimado antes de los 31 minutos, informar al usuario qué está sucediendo y preguntar si debe continuar o detenerse
- Si se alcanza el límite de 31 minutos, la alerta de tiempo tiene prioridad sobre cualquier otra notificación
