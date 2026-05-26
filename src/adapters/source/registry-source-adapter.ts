import type {
  ArchiveOptions,
  ArchiveResult,
  CommentOptions,
  CommentResult,
  CreateOptions,
  CreateResult,
  PublishResult,
  RenameOptions,
  RenameResult,
  ResourceListOptions,
  ResourceMeta,
  ResourceType,
  RestoreOptions,
  RestoreResult,
  VersionInfo,
} from "../../domain/resource.js";
import type {
  SourceDocsOptions,
  SourceDocsResult,
} from "../../domain/source-docs.js";
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

  async list(
    _type: ResourceType,
    _options?: ResourceListOptions,
  ): Promise<ResourceMeta[]> {
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

  async isArchived(_type: ResourceType, _name: string): Promise<boolean> {
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

  async create(
    _type: ResourceType,
    _name: string,
    _options: CreateOptions,
  ): Promise<CreateResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async rename(
    _type: ResourceType,
    _oldName: string,
    _newName: string,
    _options?: RenameOptions,
  ): Promise<RenameResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async comment(
    _type: ResourceType,
    _name: string,
    _options: CommentOptions,
  ): Promise<CommentResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async archive(
    _type: ResourceType,
    _name: string,
    _options?: ArchiveOptions,
  ): Promise<ArchiveResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async restore(
    _type: ResourceType,
    _name: string,
    _options?: RestoreOptions,
  ): Promise<RestoreResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }

  async initDocs(_options: SourceDocsOptions): Promise<SourceDocsResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Registry source is reserved for phase 2.",
    );
  }
}
