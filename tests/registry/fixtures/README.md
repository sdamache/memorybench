# Provider Registry Test Fixtures

This directory contains test fixtures for validating the ProviderRegistry loader and validator.

## Fixture Structure

Each fixture represents a provider directory with specific characteristics for testing:

### Valid Fixtures (Phase 3 - User Story 1)
- **valid-minimal/**: Minimal valid provider with core operations only
- **valid-full/**: Full provider with all optional operations

### Error Fixtures (Phase 5 - User Story 3)
- **missing-manifest/**: Provider with index.ts but no manifest.json
- **missing-adapter/**: Provider with manifest.json but no index.ts
- **name-mismatch/**: Provider where manifest.provider.name ≠ adapter.name
- **duplicate-name/**: Two providers with same manifest.provider.name

### Legacy Fixtures (Phase 6 - User Story 4)
- **legacy-template/**: Provider using old TemplateType interface

## Usage

Fixtures are used by:
- `tests/registry/registry.test.ts` - Registry loading and validation tests
- `tests/registry/adapter.test.ts` - LegacyProviderAdapter tests
- `tests/unit/provider-interface.test.ts` - Type conformance tests

## Creating New Fixtures

Each fixture directory should contain:
1. `manifest.json` - Provider manifest (if testing valid path)
2. `index.ts` - Provider adapter export (if testing valid path)
3. Intentional omissions for error testing

Refer to tasks.md Phase 3-6 for specific fixture requirements.
