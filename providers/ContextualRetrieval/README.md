# Anthropic Contextual Retrieval Provider

This directory contains the RAG (Retrieval-Augmented Generation) provider implementation with PostgreSQL and pgvector for vector similarity search.

## Database Setup with Docker

### Prerequisites
- Docker installed on your system

### Quick Start

1. **Build the Docker image:**
   ```bash
   docker build -t rag-postgres .
   ```

2. **Run the PostgreSQL container:**
   ```bash
   docker run -d --name rag-postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=rag_db \
     -p 5432:5432 \
     rag-postgres
   ```

3. **Connect to the database:**
   ```bash
   # Using psql inside the container
   docker exec -it rag-postgres psql -U postgres -d rag_db

   # Or connect from your host machine
   PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres -d rag_db
   ```

### Database Features

- **PostgreSQL 16**: Modern PostgreSQL database
- **pgvector 0.7.0**: Vector similarity search extension for AI/ML applications
- **Default Configuration**:
  - Database: `rag_db`
  - Username: `postgres`
  - Password: `postgres`
  - Port: `5432` (host) / `5432` (container)

### Container Management

```bash
# Start the container
docker start rag-postgres

# Stop the container
docker stop rag-postgres

# Remove the container
docker rm rag-postgres

# View container logs
docker logs rag-postgres
```

### Connection Details

- **Host**: `localhost` (when running locally)
- **Port**: `5432`
- **Database**: `rag_db`
- **Username**: `postgres`
- **Password**: `postgres`

The pgvector extension is automatically available for creating vector columns and performing similarity searches.
