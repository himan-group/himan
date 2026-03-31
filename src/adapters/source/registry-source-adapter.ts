import type {
  PublishResult,
  ResourceMeta,
  ResourceType,
  VersionInfo,
} from "../../domain/resource.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "./resource-source-adapter.js";
import { HimanError, errorCodes } from "../../utils/errors.js";

export class RegistrySourceAdapter implements ResourceSourceAdapter {
  async init(_sourceConfig: SourceConfig): Promise<void> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async list(_type: ResourceType): Promise<ResourceMeta[]> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async history(_type: ResourceType, _name: string): Promise<VersionInfo[]> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async pull(
    _type: ResourceType,
    _name: string,
    _version: string,
    _targetDir: string,
  ): Promise<void> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async publish(
    _type: ResourceType,
    _name: string,
    _version: string,
    _sourceDir: string,
  ): Promise<PublishResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }
}
