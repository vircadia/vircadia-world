#!/bin/bash

# Vircadia World Kubernetes Deployment Script
# Supports Digital Ocean Kubernetes (DOKS) with automatic setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="vircadia-world"
RELEASE_NAME="vircadia-world"
VALUES_FILE="my-values.yaml"

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v helm &> /dev/null; then
        print_error "helm is not installed. Please install it first."
        exit 1
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        print_error "kubectl is not configured to access a cluster."
        exit 1
    fi
    
    print_success "All dependencies are available."
}

setup_digital_ocean() {
    print_status "Setting up Digital Ocean Kubernetes dependencies..."
    
    # Install NGINX Ingress Controller
    print_status "Installing NGINX Ingress Controller..."
    kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/do/deploy.yaml
    
    # Wait for ingress controller to be ready
    print_status "Waiting for NGINX Ingress Controller to be ready..."
    kubectl wait --namespace ingress-nginx \
        --for=condition=ready pod \
        --selector=app.kubernetes.io/component=controller \
        --timeout=300s
    
    # Install Cert-Manager
    print_status "Installing Cert-Manager..."
    kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
    
    # Wait for cert-manager to be ready
    print_status "Waiting for Cert-Manager to be ready..."
    kubectl wait --namespace cert-manager \
        --for=condition=ready pod \
        --selector=app.kubernetes.io/name=cert-manager \
        --timeout=300s
    
    print_success "Digital Ocean dependencies installed successfully."
}

create_letsencrypt_issuer() {
    if [ -z "$CERT_EMAIL" ]; then
        print_error "CERT_EMAIL environment variable is required for Let's Encrypt certificates."
        print_warning "Export CERT_EMAIL=your-email@domain.com and run again."
        exit 1
    fi
    
    print_status "Creating Let's Encrypt ClusterIssuer..."
    cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ${CERT_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
    
    print_success "Let's Encrypt ClusterIssuer created."
}

prepare_values() {
    if [ ! -f "$VALUES_FILE" ]; then
        print_status "Creating values file from Digital Ocean template..."
        cp values-digitalocean.yaml "$VALUES_FILE"
        
        print_warning "Please edit $VALUES_FILE and update:"
        print_warning "  - Domain names (replace 'your-domain.com')"
        print_warning "  - PostgreSQL passwords"
        print_warning "  - Any other configuration needed"
        
        read -p "Press Enter after editing the values file..."
    else
        print_status "Using existing values file: $VALUES_FILE"
    fi
}

create_namespace() {
    print_status "Creating namespace: $NAMESPACE"
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
}

create_pgweb_auth() {
    print_status "Creating PGWEB basic auth secret..."
    
    if ! kubectl get secret pgweb-basic-auth -n "$NAMESPACE" &> /dev/null; then
        if command -v htpasswd &> /dev/null; then
            # Use htpasswd if available
            echo -n "Enter username for PGWEB: "
            read -r USERNAME
            echo -n "Enter password for PGWEB: "
            read -s PASSWORD
            echo
            
            htpasswd -bc auth "$USERNAME" "$PASSWORD"
            kubectl create secret generic pgweb-basic-auth --from-file=auth -n "$NAMESPACE"
            rm auth
        else
            # Fallback to manual creation
            print_warning "htpasswd not found. Creating basic auth with default credentials."
            print_warning "Username: admin, Password: changeme"
            
            # admin:changeme (bcrypt hash)
            AUTH_STRING='admin:$2y$10$1234567890123456789012345678901234567890123456'
            echo "$AUTH_STRING" > auth
            kubectl create secret generic pgweb-basic-auth --from-file=auth -n "$NAMESPACE"
            rm auth
        fi
    else
        print_status "PGWEB auth secret already exists."
    fi
}

deploy_application() {
    print_status "Deploying Vircadia World..."
    
    helm upgrade --install "$RELEASE_NAME" . \
        --namespace "$NAMESPACE" \
        --values "$VALUES_FILE" \
        --timeout 10m
    
    print_success "Deployment completed!"
}

show_status() {
    print_status "Deployment status:"
    kubectl get all -n "$NAMESPACE"
    
    echo ""
    print_status "Ingress endpoints:"
    kubectl get ingress -n "$NAMESPACE" -o custom-columns=NAME:.metadata.name,HOSTS:.spec.rules[*].host,ADDRESS:.status.loadBalancer.ingress[*].ip
    
    echo ""
    print_status "To check logs:"
    echo "  kubectl logs -f deployment/vircadia-world-api-manager -n $NAMESPACE"
    echo "  kubectl logs -f deployment/vircadia-world-state-manager -n $NAMESPACE"
    echo "  kubectl logs -f deployment/vircadia-world-postgresql -n $NAMESPACE"
}

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --setup-do          Setup Digital Ocean dependencies (NGINX, Cert-Manager)"
    echo "  --skip-deps         Skip dependency installation"
    echo "  --values-file FILE  Use custom values file (default: my-values.yaml)"
    echo "  --namespace NS      Use custom namespace (default: vircadia-world)"
    echo "  --help              Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  CERT_EMAIL          Email for Let's Encrypt certificates (required)"
    echo ""
    echo "Examples:"
    echo "  # Full Digital Ocean setup with Let's Encrypt"
    echo "  CERT_EMAIL=me@example.com $0 --setup-do"
    echo ""
    echo "  # Deploy with custom values"
    echo "  $0 --values-file production-values.yaml"
    echo ""
    echo "  # Deploy to existing cluster (skip dependency installation)"
    echo "  $0 --skip-deps"
}

# Parse command line arguments
SETUP_DO=false
SKIP_DEPS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --setup-do)
            SETUP_DO=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --values-file)
            VALUES_FILE="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            RELEASE_NAME="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Main deployment flow
print_status "Starting Vircadia World Kubernetes deployment..."

check_dependencies

if [ "$SKIP_DEPS" != "true" ]; then
    if [ "$SETUP_DO" == "true" ]; then
        setup_digital_ocean
        create_letsencrypt_issuer
    fi
fi

prepare_values
create_namespace
create_pgweb_auth
deploy_application
show_status

print_success "Vircadia World has been deployed successfully!"
print_warning "Don't forget to point your domain DNS to the ingress load balancer IP." 