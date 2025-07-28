# Vircadia World Kubernetes Deployment

This Helm chart deploys Vircadia World - a Virtual Reality Social Platform on Kubernetes.

## Architecture

The chart deploys the following components:
- **PostgreSQL**: Database server with persistent storage
- **PGWEB**: Database administration interface
- **API Manager**: REST API service for world management
- **State Manager**: Real-time state synchronization service

## Prerequisites

### Required Tools
- `kubectl` configured to access your cluster
- `helm` (v3.8+)
- `doctl` (for Digital Ocean clusters)

### Kubernetes Requirements
- Kubernetes 1.19+
- Ingress controller (NGINX recommended)
- Cert-manager (for TLS certificates)
- Storage class for persistent volumes

## Quick Start

### 1. Clone and Navigate
```bash
cd server/service/k8s/vircadia-world
```

### 2. Install Dependencies

#### For Digital Ocean Kubernetes (DOKS)
```bash
# Install NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/do/deploy.yaml

# Install Cert-Manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@domain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### 3. Configure Values

#### For Digital Ocean Deployment
1. Copy the Digital Ocean values file:
   ```bash
   cp values-digitalocean.yaml my-values.yaml
   ```

2. Edit `my-values.yaml` and update:
   - **Domain names**: Replace `your-domain.com` with your actual domain
   - **Passwords**: Change the default PostgreSQL passwords
   - **Email**: Update cert-manager email for Let's Encrypt
   - **Node pool**: Adjust node selector if using custom node pools

#### For Other Cloud Providers
1. Copy the default values:
   ```bash
   cp values.yaml my-values.yaml
   ```

2. Modify according to your cloud provider's specifications:
   - **Storage class**: Update to your provider's storage class
   - **Ingress class**: Change if not using NGINX
   - **Node selectors**: Adjust for your infrastructure

### 4. Create Namespace
```bash
kubectl create namespace vircadia-world
```

### 5. Deploy the Application
```bash
helm install vircadia-world . -f my-values.yaml -n vircadia-world
```

## Configuration

### Environment-Specific Values

#### Development
Use the default `values.yaml` with minimal resources and local storage.

#### Staging
```yaml
apiManager:
  replicaCount: 2
  autoscaling:
    enabled: false
stateManager:
  replicaCount: 2
  autoscaling:
    enabled: false
postgresql:
  primary:
    persistence:
      size: 10Gi
```

#### Production
Use `values-digitalocean.yaml` as a base with:
- Auto-scaling enabled
- High availability configuration
- Persistent storage
- TLS certificates
- Resource limits

### Security Configuration

#### Database Access
Create a basic auth secret for PGWEB:
```bash
htpasswd -c auth admin
kubectl create secret generic pgweb-basic-auth --from-file=auth -n vircadia-world
```

#### TLS Certificates
The chart uses cert-manager with Let's Encrypt for automatic TLS certificate provisioning.

### Custom Configuration

#### Application Settings
```yaml
application:
  debug: false           # Enable debug logging
  suppress: false        # Suppress verbose logs
  publicHost: "api.domain.com"  # Public hostname
  apiPort: 443          # Public API port
  statePort: 443        # Public state port
```

#### Resource Limits
```yaml
apiManager:
  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "1Gi"
      cpu: "1000m"
```

## Deployment Commands

### Digital Ocean Kubernetes (DOKS)

#### Connect to Cluster
```bash
doctl kubernetes cluster kubeconfig save your-cluster-name
```

#### Deploy with Monitoring
```bash
# Install with monitoring enabled
helm install vircadia-world . \
  -f values-digitalocean.yaml \
  -n vircadia-world \
  --set monitoring.enabled=true
```

#### Deploy with Custom Domain
```bash
# Deploy with your domain
helm install vircadia-world . \
  -f values-digitalocean.yaml \
  -n vircadia-world \
  --set application.publicHost=mydomain.com \
  --set apiManager.ingress.hosts[0].host=api.mydomain.com \
  --set stateManager.ingress.hosts[0].host=state.mydomain.com
```

### Google Kubernetes Engine (GKE)
```bash
# Configure kubectl
gcloud container clusters get-credentials cluster-name --zone=zone --project=project-id

# Deploy
helm install vircadia-world . -f my-values.yaml -n vircadia-world
```

### Amazon EKS
```bash
# Configure kubectl
aws eks update-kubeconfig --region region --name cluster-name

# Deploy
helm install vircadia-world . -f my-values.yaml -n vircadia-world
```

## Monitoring and Maintenance

### Check Deployment Status
```bash
# Check all resources
kubectl get all -n vircadia-world

# Check ingress
kubectl get ingress -n vircadia-world

# Check persistent volumes
kubectl get pv,pvc -n vircadia-world
```

### Access Services

#### API Endpoints
- **API Manager**: `https://api.your-domain.com`
- **State Manager**: `https://state.your-domain.com`
- **PGWEB**: `https://pgweb.your-domain.com` (protected by basic auth)

#### Local Port Forwarding
```bash
# API Manager
kubectl port-forward svc/vircadia-world-api-manager 3000:3000 -n vircadia-world

# State Manager
kubectl port-forward svc/vircadia-world-state-manager 3001:3001 -n vircadia-world

# PGWEB
kubectl port-forward svc/vircadia-world-pgweb 8081:8081 -n vircadia-world

# PostgreSQL
kubectl port-forward svc/vircadia-world-postgresql 5432:5432 -n vircadia-world
```

### Scaling
```bash
# Manual scaling
kubectl scale deployment vircadia-world-api-manager --replicas=5 -n vircadia-world

# Enable auto-scaling via Helm
helm upgrade vircadia-world . \
  -f my-values.yaml \
  -n vircadia-world \
  --set apiManager.autoscaling.enabled=true
```

### Backup Database
```bash
# Create a backup job
kubectl create job --from=cronjob/postgresql-backup manual-backup -n vircadia-world
```

## Troubleshooting

### Common Issues

#### Pods Not Starting
```bash
# Check pod status
kubectl describe pods -n vircadia-world

# Check logs
kubectl logs deployment/vircadia-world-api-manager -n vircadia-world
```

#### Database Connection Issues
```bash
# Test database connectivity
kubectl exec -it deployment/vircadia-world-postgresql -n vircadia-world -- psql -U vircadia_admin -d vircadia_world
```

#### Ingress Not Working
```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check certificates
kubectl get certificates -n vircadia-world

# Check cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager
```

#### Storage Issues
```bash
# Check storage class
kubectl get storageclass

# Check persistent volume claims
kubectl describe pvc -n vircadia-world
```

### Debugging Commands
```bash
# Get all events
kubectl get events -n vircadia-world --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n vircadia-world

# Shell into a pod
kubectl exec -it deployment/vircadia-world-api-manager -n vircadia-world -- /bin/sh
```

## Upgrade Process

### Upgrade Application
```bash
# Update image tags in values file, then:
helm upgrade vircadia-world . -f my-values.yaml -n vircadia-world
```

### Rollback
```bash
# Rollback to previous version
helm rollback vircadia-world -n vircadia-world

# Rollback to specific revision
helm rollback vircadia-world 2 -n vircadia-world
```

## Uninstall

### Remove Application
```bash
# Uninstall Helm release
helm uninstall vircadia-world -n vircadia-world

# Delete namespace
kubectl delete namespace vircadia-world
```

### Clean Up Persistent Data
```bash
# Delete persistent volumes (WARNING: This deletes all data!)
kubectl delete pv $(kubectl get pv -o jsonpath='{.items[?(@.spec.claimRef.namespace=="vircadia-world")].metadata.name}')
```

## Support

For issues specific to:
- **Kubernetes deployment**: Check this README and Kubernetes documentation
- **Digital Ocean**: Consult [DOKS documentation](https://docs.digitalocean.com/products/kubernetes/)
- **Application**: Check the main Vircadia World repository

## Contributing

To contribute to this Helm chart:
1. Test changes locally with `helm template`
2. Validate with `helm lint`
3. Test deployment on a development cluster
4. Submit pull request with detailed description 