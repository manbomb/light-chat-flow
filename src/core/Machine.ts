import SendMessageGateway from "../gateways/SendMessage.gateway";
import ClientRepository from "../repositories/Client.repository";
import Client from "./Client";
import Flow from "./Flow";
import Message from "./Message";
import State from "./State";

export default class Machine {
    constructor(
        private readonly flow: Flow,
        private readonly clientRepository: ClientRepository,
        private readonly sendMessageGateway: SendMessageGateway
    ) { }

    async startFlow(clientId: string, startState?: State): Promise<void> {
        let client: Client;

        try {
            client = await this.clientRepository.getClient(clientId);
        } catch (e) {
            client = new Client(clientId);
        }

        client.hashState = "";
        const startStateOrDefault = startState ?? this.flow.getDefaultState();
        const startStateId = startStateOrDefault.id;
        client.addStateIdToHash(startStateId);

        this.clientRepository.saveClient(client);

        await this.sendMessageGateway.send({
            id: client.id,
            ...startStateOrDefault.message
        });
    }

    async handleMessage(message: Message): Promise<void> {
        let client: Client;

        try {
            client = await this.clientRepository.getClient(message.id);
        } catch (e) {
            client = new Client(message.id);
            
            const actualState = this.flow.getStateByHash(client.hashState);
            await this.sendMessageGateway.send({
                id: client.id,
                ...actualState.message
            });

            client.addStateIdToHash(actualState.id);
            this.clientRepository.saveClient(client);
            
            return;
        }

        const hashState = client.hashState;
        const actualState = this.flow.getStateByHash(hashState);

        if (actualState.branchs.length < 1) {
            return;
        }

        let nextState: State;

        try {
            nextState = actualState.nextState(message);
        } catch(e) {
            await this.sendMessageGateway.send({
                ...actualState.catchMessage,
                id: client.id
            });
            return;
        }

        await this.sendMessageGateway.send({
            ...nextState.message,
            id: client.id
        });

        client.addStateIdToHash(nextState.id);

        await this.clientRepository.saveClient(client);
    }
}