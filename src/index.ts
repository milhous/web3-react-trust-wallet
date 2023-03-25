import type {
    Actions,
    AddEthereumChainParameter,
    Provider,
    ProviderConnectInfo,
    ProviderRpcError,
    RequestArguments,
  } from '@web3-react/types';
  import {Connector} from '@web3-react/types';
  
  type TrustWalletProvider = Provider & {
    isTrust?: boolean;
    isTrustWallet?: boolean;
    providers?: Omit<TrustWalletProvider, 'providers'>[];
    isConnected: () => boolean;
    request<T>(args: RequestArguments): Promise<T>;
    on: (event: string, args: any) => any;
    get chainId(): string;
    get accounts(): string[];
  };
  
  interface TrustWalletConstructorArgs {
    actions: Actions;
    onError?: () => void;
  }
  
  type Window = typeof Window & {
    ethereum?: TrustWalletProvider;
    trustwallet?: TrustWalletProvider;
  };
  
  export class TrustWallet extends Connector {
    /** {@inheritdoc Connector.provider} */
    public provider?: TrustWalletProvider;
    private _accounts: string[] = [];
  
    constructor({actions, onError}: TrustWalletConstructorArgs) {
      super(actions, onError);
    }
  
    public async activate(desiredChainIdOrChainParameters?: number | AddEthereumChainParameter): Promise<void> {
      if (!this.provider) {
        this.provider = this.isomorphicInitialize();
      }
  
      if (!this.provider) {
        window.open('https://trustwallet.com/browser-extension/', '_blank');
  
        return;
      }
  
      try {
        const accounts = (await this.provider.request({method: 'eth_requestAccounts'})) as string[];
        const chainId = (await this.provider.request({method: 'eth_chainId'})) as string;
        const receivedChainId = this.parseChainId(chainId);
        const desiredChainId =
          typeof desiredChainIdOrChainParameters === 'number'
            ? desiredChainIdOrChainParameters
            : desiredChainIdOrChainParameters?.chainId;
  
        if (!desiredChainId || receivedChainId === desiredChainId) {
          return this.actions.update({chainId: receivedChainId, accounts});
        }
  
        this._accounts = accounts;
  
        const desiredChainIdHex = `0x${desiredChainId.toString(16)}`;
  
        this.provider
          .request({
            method: 'wallet_switchEthereumChain',
            params: [{chainId: desiredChainIdHex}],
          })
          .catch((err: ProviderRpcError) => {
            if (err.code === 4902 && typeof desiredChainIdOrChainParameters !== 'number') {
              if (!this.provider) throw new Error('No provider');
  
              return this.provider.request({
                method: 'wallet_addEthereumChain',
                params: [{...desiredChainIdOrChainParameters, chainId: desiredChainIdHex}],
              });
            }
  
            throw err;
          });
      } catch (err) {
        if (!this.provider?.isConnected?.()) {
          const cancelActivation = this.actions.startActivation();
  
          cancelActivation();
        }
  
        throw err;
      }
    }
  
    /** {@inheritdoc Connector.connectEagerly} */
    public async connectEagerly(): Promise<void> {
      const cancelActivation = this.actions.startActivation();
  
      try {
        this.provider = this.isomorphicInitialize();
  
        if (!this.provider) return cancelActivation();
  
        const accounts = (await this.provider.request({method: 'eth_accounts'})) as string[];
  
        if (!accounts.length) throw new Error('No accounts returned');
  
        const chainId = (await this.provider.request({method: 'eth_chainId'})) as string;
  
        this.actions.update({chainId: this.parseChainId(chainId), accounts});
      } catch (error) {
        console.debug('Could not connect eagerly', error);
  
        this.actions.resetState();
      }
    }
  
    private detectProvider(): TrustWalletProvider | undefined {
      const provider =
        this.isTrust((window as unknown as Window).ethereum) ||
        (window as unknown as Window).trustwallet ||
        (window as unknown as Window).ethereum?.providers?.find(
          (provider: Omit<TrustWalletProvider, 'providers'>) => provider.isTrust || provider.isTrustWallet,
        );
  
      return provider;
    }
  
    private isTrust(ethereum?: TrustWalletProvider) {
      const isTrustWallet = !!ethereum?.isTrust || !!ethereum?.isTrustWallet;
      if (!isTrustWallet) return;
      return ethereum;
    }
  
    private isomorphicInitialize(): TrustWalletProvider | undefined {
      const provider = this.detectProvider();
  
      if (provider) {
        return provider
          .on('connect', ({chainId}: ProviderConnectInfo): void => {
            this.actions.update({chainId: Number(chainId)});
          })
          .on('disconnect', (error: ProviderRpcError): void => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.provider?.request({method: 'PUBLIC_disconnectSite'});
            this.actions.resetState();
            this.onError?.(error);
          })
          .on('chainChanged', (chainId: string): void => {
            /**
             * When switching chains, return different values based on the user's login status.
             * If the user is not logged in, return a hexadecimal value.
             * If the user is logged in, return a decimal value.
             */
            if (this.isHex(chainId)) {
              this.actions.update({chainId: this.parseChainId(chainId), accounts: this._accounts});
            } else {
              this.actions.update({chainId: Number(chainId)});
            }
          })
          .on('accountsChanged', (accounts: string[]): void => {
            if (accounts.length === 0) {
              // handle this edge case by disconnecting
              this.actions.resetState();
            } else {
              this.actions.update({accounts});
            }
          });
      }
  
      return provider;
    }
  
    private parseChainId(chainId: string) {
      return Number.parseInt(chainId, 16);
    }
  
    private isHex(chainId: string) {
      return /^0x[a-fA-F0-9]+$/.test(chainId);
    }
  }
  