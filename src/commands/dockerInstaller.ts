/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import ChildProcessProvider from '../debugging/coreclr/ChildProcessProvider';
import { LocalFileSystemProvider } from '../debugging/coreclr/fsProvider';
import { OSTempFileProvider } from '../debugging/coreclr/tempFileProvider';
import { ext } from '../extensionVariables';
import { localize } from '../localize';
import { dockerInstallStatusProvider } from '../utils/DockerInstallStatusProvider';
import { streamToFile } from '../utils/httpRequest';
import LocalOSProvider from '../utils/LocalOSProvider';
import { execAsync } from '../utils/spawnAsync';

export abstract class DockerInstallerBase {
    protected abstract downloadUrl: string;
    protected abstract fileExtension: string;
    protected abstract getInstallCommand(fileName: string): string;

    public async downloadAndInstallDocker(): Promise<void> {
        const shouldInstall: boolean = await this.preInstallCheck();
        if (shouldInstall) {
            const downloadingMessage: string = localize('vscode-docker.commands.DockerInstallerBase.downloading', 'Downloading Docker installer...');
            const installationMessage: string = localize('vscode-docker.commands.DockerInstallerBase.installationMessage', 'The Docker Desktop installation is started. Complete the installation and then start Docker Desktop.');

            const downloadedFileName: string = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: downloadingMessage },
                async () => this.downloadInstaller());

            const command = this.getInstallCommand(downloadedFileName);
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            vscode.window.showInformationMessage(installationMessage);
            await this.install(downloadedFileName, command);
        }
    }

    private async preInstallCheck(): Promise<boolean> {
        let proceedInstall = true;
        if (await dockerInstallStatusProvider.isDockerInstalledRealTimeCheck()) {
            const reinstallMessage = localize('vscode-docker.commands.DockerInstallerBase.reInstall', 'Docker Desktop is already installed. Would you like to reinstall?');
            const install = localize('vscode-docker.commands.DockerInstallerBase.reinstall', 'Reinstall')
            const response = await vscode.window.showInformationMessage(reinstallMessage, ...[install]);
            proceedInstall = response !== undefined;
        }

        return proceedInstall;
    }

    private async downloadInstaller(): Promise<string> {
        const osProvider = new LocalOSProvider();
        const processProvider = new ChildProcessProvider();
        const tempFileProvider = new OSTempFileProvider(osProvider, processProvider);
        const fileName = tempFileProvider.getTempFilename('docker', this.fileExtension);
        await streamToFile(this.downloadUrl, fileName);
        return fileName;
    }

    protected abstract install(context: IActionContext, fileName: string, cmd: string): Promise<void>;
}

export class WindowsDockerInstaller extends DockerInstallerBase {
    protected downloadUrl: string = 'https://aka.ms/download-docker-windows-vscode';
    protected fileExtension: string = 'exe';
    protected getInstallCommand(fileName: string): string {
        // Windows require double quote.
        return `"${fileName}"`;
    }

    protected async install(context: IActionContext, fileName: string, cmd: string): Promise<void> {
        const fsProvider = new LocalFileSystemProvider();
        try {
            ext.outputChannel.appendLine(localize('vscode-docker.commands.DockerInstallerBase.downloadCompleteMessage', 'Executing command {0}', cmd));
            await execAsync(cmd);
        } finally {
            if (await fsProvider.fileExists(fileName)) {
                await fsProvider.unlinkFile(fileName);
            }
        }
    }
}

export class MacDockerInstaller extends DockerInstallerBase {
    protected downloadUrl: string = 'https://aka.ms/download-docker-mac-vscode';
    protected fileExtension: string = 'dmg';
    protected getInstallCommand(fileName: string): string {
        return `chmod +x '${fileName}' && open '${fileName}'`;
    }

    protected async install(context: IActionContext, fileName: string): Promise<void> {
        const title = localize('vscode-docker.commands.MacDockerInstaller.terminalTitle', 'Docker Install');
        const command = this.getInstallCommand(fileName);

        await executeAsTask(context, command, title);
    }
}

export async function showDockerInstallNotification(): Promise<void> {
    const installMessageLinux = localize('vscode-docker.commands.dockerInstaller.installDockerInfo', 'Docker is not installed. Would you like to learn more about installing Docker?');
    const installMessageNonLinux = localize('vscode-docker.commands.dockerInstaller.installDocker', 'Docker Desktop is not installed. Would you like to install it?');
    const learnMore = localize('vscode-docker.commands.dockerInstaller.learnMore', 'Learn more')
    const install = localize('vscode-docker.commands.dockerInstaller.install', 'Install')
    const osProvider: LocalOSProvider = new LocalOSProvider();
    const dockerInstallMessage = osProvider.os === 'Linux' ? installMessageLinux : installMessageNonLinux;
    const confirmationPrompt: vscode.MessageItem = osProvider.os === 'Linux' ? { title: learnMore } : { title: install };
    const response = await vscode.window.showInformationMessage(dockerInstallMessage, ...[confirmationPrompt]);
    if (response) {
        await vscode.commands.executeCommand('vscode-docker.installDocker');
    }
}
