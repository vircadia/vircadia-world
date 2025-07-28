{{/*
Expand the name of the chart.
*/}}
{{- define "vircadia-world.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "vircadia-world.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "vircadia-world.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "vircadia-world.labels" -}}
helm.sh/chart: {{ include "vircadia-world.chart" . }}
{{ include "vircadia-world.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "vircadia-world.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vircadia-world.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "vircadia-world.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vircadia-world.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL service name
*/}}
{{- define "vircadia-world.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "vircadia-world.fullname" .) }}
{{- end }}

{{/*
API Manager service name
*/}}
{{- define "vircadia-world.apiManager.fullname" -}}
{{- printf "%s-api-manager" (include "vircadia-world.fullname" .) }}
{{- end }}

{{/*
State Manager service name
*/}}
{{- define "vircadia-world.stateManager.fullname" -}}
{{- printf "%s-state-manager" (include "vircadia-world.fullname" .) }}
{{- end }}

{{/*
PGWEB service name
*/}}
{{- define "vircadia-world.pgweb.fullname" -}}
{{- printf "%s-pgweb" (include "vircadia-world.fullname" .) }}
{{- end }} 